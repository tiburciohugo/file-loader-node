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
    try {
        const fileId = uuidv4();
        const file = req.file;

        if (!file) throw new Error("File is not provided.");

        // Initialize variables for processed file and content type
        let processedFileBuffer;
        let contentType;

        // Check if file is an image and process with Sharp
        if (file.mimetype.includes("image")) {
            // Process image file with Sharp
            processedFileBuffer = await sharp(file.buffer)
                .resize(300, 300)
                .png()
                .toBuffer();
            contentType = "image/png"; // Set content type for image
        } else if (file.mimetype === "application/pdf") {
            // Handle PDF (or other file types) without processing
            processedFileBuffer = file.buffer; // Use the original file buffer
            contentType = "application/pdf"; // Set content type for PDF
        } else {
            // Optionally handle other file types or throw an error
            throw new Error("Unsupported file type");
        }

        // Save the file to Firebase Storage
        const fileBlob = bucket.file(`${fileId}`);
        const blobStream = fileBlob.createWriteStream({
            metadata: {
                contentType: file.mimetype,
                metadata: {
                    name: file.originalname // Store the original file name in the metadata
                }
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
        const fileId = req.params.fileId; // Unique file ID from the URL
        const file = bucket.file(fileId); // Reference the file in the bucket

        // Check if the file exists in the bucket
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).json({ message: "File not found" });
        }

        // Get the file's metadata to determine the content type and potentially the extension
        const [metadata] = await file.getMetadata();

        // Generate a signed URL for temporary access to the file
        const [url] = await file.getSignedUrl({
            action: "read",
            expires: "03-09-2491" // Set this to an appropriate expiry time
        });

        res.status(200).json({
            fileId: fileId,
            fileUrl: url,
            contentType: metadata.contentType, // This will be 'application/pdf' or 'image/png'
            extension:
                metadata.contentType === "application/pdf" ? ".pdf" : ".png"
        });
    } catch (error) {
        res.status(500).json({
            message: "Error retrieving file",
            error: (error as Error).message
        });
    }
});

app.get("/file-by-name/:name", async (req, res) => {
    try {
        const fileName = req.params.name;
        const [files] = await bucket.getFiles(); // Retrieve a list of files in the bucket

        // Find the file with the matching 'name' metadata
        const file = files.find(
            (file) => file.metadata?.metadata?.name === fileName
        );

        if (!file) {
            return res.status(404).json({ message: "File not found" });
        }

        // Generate a signed URL for temporary access to the file
        const [url] = await file.getSignedUrl({
            action: "read",
            expires: "03-09-2491"
        });

        res.status(200).json({
            fileName: fileName,
            fileUrl: url,
            contentType: file.metadata.contentType
        });
    } catch (error) {
        res.status(500).json({
            message: "Error retrieving file",
            error: (error as Error).message
        });
    }
});


app.get("/files", async (req, res) => {
    try {
        const [files] = await bucket.getFiles();
        const fileUrls = files.map((file) => {
            return `https://firebasestorage.googleapis.com/v0/b/${
                bucket.name
            }/o/${encodeURIComponent(file.name)}?alt=media`;
        });

        res.status(200).json(fileUrls);
    } catch (error) {
        res.status(500).json((error as Error).message);
    }
});


app.listen(process.env.PORT, () => {
    console.log(`Server is running at http://localhost:${process.env.PORT}`);
});
