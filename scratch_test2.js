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
    const adminEmail = "admin@sliitek.com";
    const safe = adminEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
        $or: [
            { email: { $regex: `^${safe}$`, $options: "i" } },
            { email: "all" }
        ]
    };
    const res = await Notification.find(filter);
    console.log("Filter:", filter);
    console.log("Count:", res.length);
    console.log("Results:", res.map(r => r.email));
    process.exit();
})
.catch(err => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
});
