import express from "express";
import multer from "multer";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import * as admin from "firebase-admin";
import fs from "fs";
import morgan from "morgan";
import "dotenv/config";

// Check if the environment variable is set
if (!process.env.FIREBASE_ADMIN_SDK_KEY_PATH) {
    console.error(
        "The FIREBASE_ADMIN_SDK_KEY_PATH environment variable is not set."
    );
    process.exit(1); // Exit the application
}

// Read the service account key file
const serviceAccountPath = process.env.FIREBASE_ADMIN_SDK_KEY_PATH;
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

// Initialize Firebase
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET_URL
});
const bucket = admin.storage().bucket();

// Initialize express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("uploads"));
app.use(morgan("dev"));

// Configure multer
const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
    res.status(200).json({ status: "up", message: "API is running" });
});

// POST Endpoint for file upload
app.post("/upload", upload.single("file"), async (req, res) => {
    console.log("File: ", req.file); // Log the file object
    console.log("Body: ", req.body); // Log the body
    try {
        const fileId = uuidv4();
        const file = req.file;

        if (!file) throw new Error("File is not provided.");

        const processedFileBuffer = await sharp(file.buffer)
            .resize(300, 300)
            .png()
            .toBuffer();

        // Save the processed file to Firebase Storage
        const fileBlob = bucket.file(`${fileId}.png`);
        const blobStream = fileBlob.createWriteStream({
            metadata: {
                contentType: "image/png"
            }
        });

        blobStream.on("error", (error: Error) => {
            throw new Error("Blob stream error: " + error);
        });

        blobStream.on("finish", () => {
            // The public URL can be used to directly access the file via HTTP.
            const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${
                bucket.name
            }/o/${encodeURIComponent(fileBlob.name)}?alt=media`;
            res.status(200).json({
                fileId: fileId,
                fileUrl: publicUrl,
                message: "File uploaded and processed successfully"
            });
        });

        blobStream.end(processedFileBuffer);
    } catch (error) {
        res.status(500).json((error as Error).message);
    }
});

app.get("/file/:fileId", async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const filePath = `./uploads/${fileId}.png`;

        if (!fs.existsSync(filePath)) throw new Error("File does not exist.");

        res.status(200).sendFile(filePath, { root: "." });
    } catch (error) {
        res.status(500).json((error as Error).message);
    }
});

// Start the server
app.listen(process.env.PORT, () => {
    console.log(`Server is running at http://localhost:${process.env.PORT}`);
});
