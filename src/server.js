const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

const notificationRoutes = require('./routes/notificationRoutes');
const sampleUserRoutes = require("./routes/sampleUserRoutes")

// Basic route
app.get('/', (req, res) => {
    res.send('API is running...');
});

// Mount Routes
app.use('/api/notifications', notificationRoutes);
app.use("/api/sample-users", sampleUserRoutes)

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
