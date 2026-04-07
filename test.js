const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const mongoose = require('mongoose');
const Notification = require('./src/models/Notification');

if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing in .env");
    process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
.then(async () => {
    const res = await Notification.find({});
    console.log("All notifications:");
    res.forEach(n => console.log(n._id, n.email, n.senderEmail, n.title));
    process.exit();
})
.catch(err => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
});
