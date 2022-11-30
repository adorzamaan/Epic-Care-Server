const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.stripe_secret_key);
require("colors");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.epicCareDb}:${process.env.epircDbPass}@cluster0.chgrg5k.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("Unauthorized Access");
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.access_Token, function (err, decoded) {
    if (err) {
      res.status(403).send({ message: "Unauthorized Access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function verifyAdmin(req, res, next) {
  const decodedEmail = req.decoded.email;
  const query = { email: decodedEmail };
  const user = await usersCollection.findOne(query);
  if (user?.role !== "admin") {
    return res.status(403).send({ message: "Forbidden Access" });
  }
  next();
}

async function dbConnect() {
  try {
    client.connect();
    console.log("database connented".bgGreen);
  } catch (error) {
    console.log(error.message);
  }
}
dbConnect();

// database collection

const apointmentCollection = client
  .db("EpicCareDbUser")
  .collection("apointmentOptions");
const bookingsCollection = client.db("EpicCareDbUser").collection("bookings");

const usersCollection = client.db("EpicCareDbUser").collection("users");
const doctorsCollection = client.db("EpicCareDbUser").collection("doctors");
const paymentCollection = client.db("EpicCareDbUser").collection("payments");
// endpoint start

app.get("/apointmentOptions", async (req, res) => {
  try {
    const date = req.query.date;
    // console.log(date);
    const query = {};
    const options = await apointmentCollection.find(query).toArray();
    const bookingQuery = { appointmentDate: date };
    const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

    options.forEach((option) => {
      // console.log(option);
      const optionBooked = alreadyBooked.filter(
        (book) => book.treatment === option.name
      );
      const bookSlots = optionBooked.map((book) => book.slot);
      const remainingSlots = option.slots.filter(
        (slot) => !bookSlots.includes(slot)
      );
      // console.log(date, option.name, bookSlots);
      option.slots = remainingSlots;
    });

    res.send({
      success: true,
      message: "Successfully got the data",
      data: options,
    });
  } catch (error) {
    res.send({
      sucess: false,
      error: error.message,
    });
  }
});

app.get("/apointmentSpecialty", async (req, res) => {
  try {
    const query = {};
    const result = await apointmentCollection
      .find(query)
      .project({ name: 1 })
      .toArray();
    res.send({
      success: true,
      message: "Successfully got the data",
      data: result,
    });
  } catch (error) {
    res.send({
      sucess: false,
      error: error.message,
    });
  }
});

app.post("/bookings", async (req, res) => {
  try {
    const booking = req.body;
    const query = {
      appointmentDate: booking.appointmentDate,
      email: booking.email,
      treatment: booking.treatment,
    };
    const alreadyBooked = await bookingsCollection.find(query).toArray();
    if (alreadyBooked.length) {
      return res.send({
        sucess: false,
        message: `You already have booking on ${booking.appointmentDate}`,
      });
    }
    const result = await bookingsCollection.insertOne(booking);
    // console.log(result);
    if (result.insertedId) {
      res.send({
        success: true,
        message: `Hey your apointment is Booked now`,
      });
    } else {
      res.send({
        success: false,
        message: "Could not Booked the Apoinment",
      });
    }
  } catch (error) {
    res.send({
      success: false,
      message: error.message,
    });
  }
});

app.get("/bookings", verifyJWT, async (req, res) => {
  try {
    const email = req.query.email;
    const decodedEmail = req.decoded.email;
    if (email !== decodedEmail) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    const query = { email: email };
    const bookings = await bookingsCollection.find(query).toArray();
    res.send({
      success: true,
      message: "Here is your apointment",
      data: bookings,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});

app.get("/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: ObjectId(id) };
    const result = await bookingsCollection.findOne(query);
    res.send({
      success: true,
      message: "Here is your apointment",
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});

app.post("/create-payment-intent", verifyJWT, async (req, res) => {
  const booking = req.body;
  const price = booking.price;
  const amount = price * 100;

  const paymentIntent = await stripe.paymentIntents.create({
    currency: "usd",
    amount: amount,
    payment_method_types: ["card"],
  });
  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

app.post("/payments", verifyJWT, async (req, res) => {
  const payment = req.body;
  const result = await paymentCollection.insertOne(payment);
  const id = payment.bookingId;
  const filter = { _id: ObjectId(id) };
  const updateDoc = {
    $set: {
      paid: true,
      transcationId: payment.transcationId,
    },
  };
  const updatedResult = await bookingsCollection.updateOne(filter, updateDoc);
  res.send(result);
});

app.get("/jwt", async (req, res) => {
  const email = req.query.email;
  const query = { email: email };
  const user = await usersCollection.findOne(query);
  // console.log(user);
  if (user) {
    const token = jwt.sign({ email }, process.env.access_Token, {
      expiresIn: "365d",
    });
    return res.send({ accessToken: token });
  }
  res.status(403).send({ accessToken: "forbidden Acccess" });
});

app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    const result = await usersCollection.insertOne(user);
    res.send({
      success: true,
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});
app.get("/users", async (req, res) => {
  try {
    const query = {};
    const result = await usersCollection.find(query).toArray();
    res.send({
      success: true,
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});

app.get("/users/admin/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const query = { email };
    const user = await usersCollection.findOne(query);
    res.send({
      success: true,
      isAdmin: user?.role === "admin",
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});

app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    // const decodedEmail = req.decoded.email;
    // const query = { email: decodedEmail };
    // const user = await usersCollection.findOne(query);
    // if (user?.role !== "admin") {
    //   return res.status(403).send({ message: "Forbidden Access" });
    // }
    const id = req.params.id;
    const filter = { _id: ObjectId(id) };
    const options = { upsert: true };
    const updatedDoc = {
      $set: {
        role: "admin",
      },
    };
    const result = await usersCollection.updateOne(filter, updatedDoc, options);
    res.send({
      success: true,
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});
app.delete("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: ObjectId(id) };
    const result = await usersCollection.deleteOne(query);
    res.send({
      success: true,
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});

// temporary updated price field
app.get("/addPrice", async (req, res) => {
  const filter = {};
  const options = { upsert: true };
  const updatedDoc = {
    $set: {
      price: 99,
    },
  };
  const result = await apointmentCollection.updateMany(
    filter,
    updatedDoc,
    options
  );
  res.send(result);
});

app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const doctor = req.body;
    const result = await doctorsCollection.insertOne(doctor);
    res.send(result);
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});

app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const query = {};
    const result = await doctorsCollection.find(query).toArray();
    res.send({
      success: true,
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});
app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: ObjectId(id) };
    const result = await doctorsCollection.deleteOne(query);
    res.send({
      success: true,
      data: result,
    });
  } catch (error) {
    res.send({
      success: false,
      error: error.message,
    });
  }
});
// endpoint end here

// default server status
app.get("/", (req, res) => {
  res.send("Hello i am from backend server");
});

// server running
app.listen(port, () => {
  console.log(`complete doctor portal server running on${port}`);
});
