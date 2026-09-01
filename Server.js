const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());

// Paylor webhook needs the raw request body
app.use("/paylor-callback", express.raw({ type: "*/*" }));

// Normal JSON requests
app.use(express.json());


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/health", (req, res) => {
    res.json({
        success: true,
        service: "Wema Charity Foundation Backend",
        paymentGateway: "Paylor",
        status: "online"
    });
});


// ======================================================
// PAYLOR STK PUSH
// ======================================================

app.post("/stk-push", async (req, res) => {

    try {

        let { name, phone, amount } = req.body;

        console.log("");
        console.log("=================================");
        console.log("      WEMA DONATION REQUEST");
        console.log("=================================");
        console.log("Name:", name);
        console.log("Phone:", phone);
        console.log("Amount:", amount);
        console.log("=================================");

        // --------------------------------------------------
        // VALIDATE REQUIRED FIELDS
        // --------------------------------------------------

        if (!name || !phone || amount === undefined) {
            return res.status(400).json({
                success: false,
                message:
                    "Name, phone number and amount are required"
            });
        }

        // --------------------------------------------------
        // CLEAN PHONE NUMBER
        // --------------------------------------------------

        phone = String(phone)
            .replace(/\s+/g, "")
            .replace(/-/g, "");

        if (phone.startsWith("+254")) {
            phone = phone.substring(1);
        }

        if (phone.startsWith("0")) {
            phone = "254" + phone.substring(1);
        }

        // Only Kenyan mobile numbers
        if (!/^2547\d{8}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message:
                    "Please enter a valid Kenyan M-Pesa number"
            });
        }

        // --------------------------------------------------
        // FLEXIBLE AMOUNT
        // --------------------------------------------------

        const numericAmount = Number(amount);

        if (
            !Number.isFinite(numericAmount) ||
            numericAmount <= 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Please enter a valid donation amount"
            });
        }

        const donationAmount =
            Math.round(numericAmount * 100) / 100;

        // --------------------------------------------------
        // UNIQUE REFERENCE
        // --------------------------------------------------

        const reference =
            "WEMA-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 10000);

        // --------------------------------------------------
        // PAYLOR CALLBACK
        // --------------------------------------------------

        const callbackUrl =
            `${process.env.BACKEND_URL}/paylor-callback`;

        console.log("");
        console.log("===== PAYLOR STK PUSH =====");
        console.log("Phone:", phone);
        console.log("Amount:", donationAmount);
        console.log("Reference:", reference);
        console.log(
            "Channel:",
            process.env.PAYLOR_CHANNEL_ID
        );
        console.log("Callback:", callbackUrl);
        console.log("===========================");

        // --------------------------------------------------
        // PAYLOR API
        // --------------------------------------------------

        const response = await axios.post(

            "https://api.paylorke.com/api/v1/merchants/payments/stk-push",

            {
                phone: phone,

                amount: donationAmount,

                reference: reference,

                channelId:
                    process.env.PAYLOR_CHANNEL_ID,

                description:
                    "Wema Charity Foundation Donation",

                callbackUrl:
                    callbackUrl
            },

            {
                headers: {

                    Authorization:
                        `Bearer ${process.env.PAYLOR_API_KEY}`,

                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json",

                    "Idempotency-Key":
                        reference
                }
            }
        );

        console.log("");
        console.log("===== PAYLOR RESPONSE =====");
        console.log(response.data);
        console.log("===========================");

        // --------------------------------------------------
        // TRANSACTION ID
        // --------------------------------------------------

        const transactionId =
            response.data?.transactionId;

        const status =
            response.data?.status;

        if (!transactionId) {

            return res.status(502).json({

                success: false,

                message:
                    "Paylor did not return a transaction ID",

                data:
                    response.data

            });
        }

        // --------------------------------------------------
        // RESPONSE TO FRONTEND
        // --------------------------------------------------

        return res.json({

            success: true,

            paid: false,

            donorName: name,

            phone: phone,

            amount: donationAmount,

            transactionId:
                transactionId,

            checkout_request_id:
                transactionId,

            reference:
                reference,

            status:
                status

        });

    } catch (error) {

        console.log("");
        console.log("===== PAYLOR STK ERROR =====");

        console.log(
            error.response?.data ||
            error.message
        );

        console.log("============================");

        return res.status(
            error.response?.status || 500
        ).json({

            success: false,

            message:
                error.response?.data?.message ||
                "Unable to initiate donation payment",

            data:
                error.response?.data ||
                null

        });
    }
});


// ======================================================
// PAYLOR CALLBACK / WEBHOOK
// ======================================================

app.post(
    "/paylor-callback",
    (req, res) => {

        try {

            const signature =
                req.headers["x-webhook-signature"];

            console.log("");
            console.log("=================================");
            console.log("        PAYLOR CALLBACK");
            console.log("=================================");

            // --------------------------------------------------
            // SIGNATURE REQUIRED
            // --------------------------------------------------

            if (!signature) {

                console.log(
                    "Missing webhook signature"
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Missing webhook signature"
                });
            }

            const rawBody = req.body;

            // --------------------------------------------------
            // VERIFY SIGNATURE
            // --------------------------------------------------

            const expectedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        process.env.PAYLOR_WEBHOOK_SECRET
                    )
                    .update(rawBody)
                    .digest("hex");

            const receivedBuffer =
                Buffer.from(signature);

            const expectedBuffer =
                Buffer.from(expectedSignature);

            if (
                receivedBuffer.length !==
                expectedBuffer.length
            ) {

                console.log(
                    "Invalid webhook signature"
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid signature"
                });
            }

            if (
                !crypto.timingSafeEqual(
                    receivedBuffer,
                    expectedBuffer
                )
            ) {

                console.log(
                    "Invalid webhook signature"
                );

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid signature"
                });
            }

            // --------------------------------------------------
            // READ PAYMENT
            // --------------------------------------------------

            const payment =
                JSON.parse(
                    rawBody.toString("utf8")
                );

            console.log(
                "PAYLOR PAYMENT:",
                payment
            );

            const paymentStatus =
                String(
                    payment.status || ""
                ).toUpperCase();

            console.log(
                "Status:",
                paymentStatus
            );

            console.log(
                "Transaction ID:",
                payment.transactionId ||
                payment.id
            );

            console.log(
                "Reference:",
                payment.reference
            );

            console.log(
                "Amount:",
                payment.amount
            );

            // --------------------------------------------------
            // SUCCESS
            // --------------------------------------------------

            if (
                paymentStatus === "COMPLETED"
            ) {

                console.log(
                    "================================="
                );

                console.log(
                    "✅ WEMA DONATION SUCCESSFUL"
                );

                console.log(
                    "Amount:",
                    payment.amount
                );

                console.log(
                    "Transaction:",
                    payment.transactionId ||
                    payment.id
                );

                console.log(
                    "Reference:",
                    payment.reference
                );

                console.log(
                    "================================="
                );

                // Payment is confirmed here.
                // A database can be added later if required.
            }

            // --------------------------------------------------
            // FAILED / CANCELLED
            // --------------------------------------------------

            if (
                paymentStatus === "FAILED" ||
                paymentStatus === "CANCELLED"
            ) {

                console.log(
                    "❌ WEMA DONATION NOT COMPLETED"
                );

                console.log(
                    "Status:",
                    paymentStatus
                );
            }

            return res.status(200).json({
                success: true
            });

        } catch (error) {

            console.log(
                "Paylor webhook error:",
                error.message
            );

            return res.status(500).json({
                success: false
            });
        }
    }
);


// ======================================================
// PAYMENT STATUS
// ======================================================

app.post(
    "/payment-status",
    async (req, res) => {

        try {

            console.log(
                "PAYMENT STATUS REQUEST:",
                req.body
            );

            const transactionId =
                req.body?.transactionId ||
                req.body?.checkout_request_id ||
                req.body?.transaction_id ||
                req.query?.transactionId ||
                req.query?.checkout_request_id;

            console.log(
                "RESOLVED TRANSACTION ID:",
                transactionId
            );

            if (!transactionId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "transactionId is required"
                });
            }

            const response =
                await axios.get(

                    `https://api.paylorke.com/api/v1/merchants/payments/transactions/${encodeURIComponent(transactionId)}`,

                    {
                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYLOR_API_KEY}`,

                            Accept:
                                "application/json"

                        }
                    }
                );

            console.log("");
            console.log(
                "===== PAYLOR PAYMENT STATUS ====="
            );

            console.log(response.data);

            // --------------------------------------------------
            // NORMALIZE STATUS
            // --------------------------------------------------

            const paymentStatus =
                response.data?.status ||
                response.data?.data?.status ||
                response.data?.transaction?.status ||
                response.data?.payment?.status ||
                response.data?.result?.status ||
                "";

            console.log(
                "NORMALIZED STATUS:",
                paymentStatus
            );

            return res.json({

                success: true,

                status:
                    String(
                        paymentStatus
                    ).toLowerCase(),

                data:
                    response.data

            });

        } catch (error) {

            console.log(
                "Payment status error:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status || 500
            ).json({

                success: false,

                message:
                    "Unable to check payment status",

                data:
                    error.response?.data ||
                    null

            });
        }
    }
);


// ======================================================
// START SERVER
// ======================================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "================================="
        );
        console.log(
            " WEMA CHARITY FOUNDATION BACKEND"
        );
        console.log(
            "================================="
        );
        console.log(
            `Server running on port ${PORT}`
        );
        console.log(
            "Paylor: Connected"
        );
        console.log(
            "================================="
        );
        console.log("");
    }
);
