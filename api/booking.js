"use strict";

/*
=========================================================
MC GRAHAM BOOKING API
Vercel Serverless Function
=========================================================

Required environment variable:

RESEND_API_KEY

Optional:

TURNSTILE_SECRET_KEY
GRAHAM_EMAIL

Recommended:

GRAHAM_EMAIL=grahamesongakenya@gmail.com
*/

const MAX_BODY_SIZE = 12000;

const ALLOWED_EVENT_TYPES = new Set([
    "Corporate Event / Conference",
    "Awards / Gala Dinner",
    "Panel Moderation",
    "Product Launch",
    "Book Launch"
]);

/*
=========================================================
BASIC IN-MEMORY RATE LIMIT

Important:
Vercel serverless functions are distributed.

This is useful as an additional protection layer,
but NOT a replacement for a proper distributed
rate limiter such as Vercel/Upstash/Cloudflare.

Limit:
5 requests per IP per 10 minutes per warm instance.
=========================================================
*/

const rateStore = globalThis.__MC_GRAHAM_RATE_STORE ||
    new Map();

globalThis.__MC_GRAHAM_RATE_STORE = rateStore;

const RATE_LIMIT = 5;
const RATE_WINDOW = 10 * 60 * 1000;

function getClientIP(request) {

    const forwarded =
        request.headers.get("x-forwarded-for");

    if(forwarded){

        return forwarded
            .split(",")[0]
            .trim()
            .slice(0,100);

    }

    const realIP =
        request.headers.get("x-real-ip");

    return (realIP || "unknown").slice(0,100);
}

function isRateLimited(ip){

    const now = Date.now();

    const existing =
        rateStore.get(ip);

    if(!existing){

        rateStore.set(ip,{
            count:1,
            firstRequest:now
        });

        return false;
    }

    if(now - existing.firstRequest > RATE_WINDOW){

        rateStore.set(ip,{
            count:1,
            firstRequest:now
        });

        return false;
    }

    existing.count++;

    if(existing.count > RATE_LIMIT){

        return true;
    }

    return false;
}

/*
=========================================================
VALIDATION HELPERS
=========================================================
*/

function cleanString(value,maxLength){

    if(typeof value !== "string"){
        return "";
    }

    return value
        .replace(/\u0000/g,"")
        .trim()
        .slice(0,maxLength);
}

function validEmail(email){

    if(email.length > 254){
        return false;
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPhone(phone){

    return /^[0-9+\-\s()]{7,30}$/.test(phone);
}

function validDate(date){

    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
        return false;
    }

    const parsed =
        new Date(`${date}T00:00:00`);

    return !Number.isNaN(parsed.getTime());
}

/*
=========================================================
TURNSTILE
=========================================================
*/

async function verifyTurnstile(token,ip){

    const secret =
        process.env.TURNSTILE_SECRET_KEY;

    /*
       If you haven't configured Turnstile yet,
       the API can still operate.

       Once configured, every request must provide
       a valid token.
    */

    if(!secret){

        return {
            success:true,
            skipped:true
        };
    }

    if(!token){

        return {
            success:false
        };
    }

    try{

        const response =
            await fetch(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                {
                    method:"POST",
                    headers:{
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    },
                    body:new URLSearchParams({
                        secret,
                        response:token,
                        remoteip:ip
                    })
                }
            );

        const result =
            await response.json();

        return {
            success:Boolean(result.success)
        };

    }catch(error){

        console.error(
            "Turnstile verification failed."
        );

        return {
            success:false
        };
    }
}

/*
=========================================================
RESEND
=========================================================
*/

async function sendEmail(booking){

    const apiKey =
        process.env.RESEND_API_KEY;

    if(!apiKey){

        throw new Error(
            "Email service is not configured."
        );
    }

    const destination =
        process.env.GRAHAM_EMAIL ||
        "grahamesongakenya@gmail.com";

    const subject =
        `New MC Graham Booking Request — ${booking.name}`;

    /*
       Escape HTML before putting user data
       inside an HTML email.
    */

    const escapeHTML = (value) => {

        return String(value || "")
            .replace(/&/g,"&amp;")
            .replace(/</g,"&lt;")
            .replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;")
            .replace(/'/g,"&#039;");
    };

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>New MC Graham Booking</title>
</head>

<body style="font-family:Arial,sans-serif;background:#faf8f3;padding:30px;color:#151515;">

<div style="max-width:700px;margin:auto;background:#ffffff;padding:35px;border-radius:8px;">

<h1 style="margin-top:0;color:#0B0B0B;">
New Booking Request
</h1>

<div style="height:4px;width:70px;background:#C85A32;margin-bottom:30px;"></div>

<p>
<strong>Name:</strong>
${escapeHTML(booking.name)}
</p>

<p>
<strong>Organisation:</strong>
${escapeHTML(booking.organisation || "-")}
</p>

<p>
<strong>Email:</strong>
${escapeHTML(booking.email)}
</p>

<p>
<strong>Phone:</strong>
${escapeHTML(booking.phone)}
</p>

<p>
<strong>Event Type:</strong>
${escapeHTML(booking.eventType)}
</p>

<p>
<strong>Event Date:</strong>
${escapeHTML(booking.eventDate)}
</p>

<p>
<strong>Venue:</strong>
${escapeHTML(booking.venue || "-")}
</p>

<hr style="border:0;border-top:1px solid #ddd;margin:30px 0;">

<h3>Event Details</h3>

<p style="white-space:pre-wrap;">
${escapeHTML(booking.details || "-")}
</p>

<hr style="border:0;border-top:1px solid #ddd;margin:30px 0;">

<p style="font-size:12px;color:#777;">
This booking was submitted through the official MC Graham website.
</p>

</div>

</body>
</html>
`;

    const response =
        await fetch(
            "https://api.resend.com/emails",
            {
                method:"POST",

                headers:{
                    "Authorization":
                        `Bearer ${apiKey}`,
                    "Content-Type":
                        "application/json"
                },

                body:JSON.stringify({

                    from:
                        "MC Graham Website <onboarding@resend.dev>",

                    to:[destination],

                    reply_to:
                        booking.email,

                    subject,

                    html

                })
            }
        );

    const result =
        await response.json();

    if(!response.ok){

        console.error(
            "Email provider error:",
            result
        );

        throw new Error(
            "Unable to send booking notification."
        );
    }

    return result;
}

/*
=========================================================
MAIN HANDLER
=========================================================
*/

module.exports = async function handler(req,res){

    /*
       Security headers at API level.
    */

    res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
    );

    res.setHeader(
        "Referrer-Policy",
        "strict-origin-when-cross-origin"
    );

    res.setHeader(
        "Cache-Control",
        "no-store"
    );

    /*
       Only POST is allowed.
    */

    if(req.method !== "POST"){

        res.setHeader(
            "Allow",
            "POST"
        );

        return res.status(405).json({
            message:"Method not allowed."
        });
    }

    /*
       Reject unexpected content types.
    */

    const contentType =
        req.headers["content-type"] || "";

    if(!contentType.includes("application/json")){

        return res.status(415).json({
            message:"Unsupported content type."
        });
    }

    /*
       IP rate limiting.
    */

    const ip =
        getClientIP(
            new Request(
                "https://example.com",
                {
                    headers:req.headers
                }
            )
        );

    if(isRateLimited(ip)){

        return res.status(429).json({
            message:
                "Too many requests. Please wait a few minutes and try again."
        });
    }

    /*
       Request size check.
    */

    const contentLength =
        Number(req.headers["content-length"] || 0);

    if(contentLength > MAX_BODY_SIZE){

        return res.status(413).json({
            message:
                "Request is too large."
        });
    }

    /*
       Parse body safely.
    */

    let body;

    try{

        body =
            typeof req.body === "string"
                ? JSON.parse(req.body)
                : req.body;

    }catch(error){

        return res.status(400).json({
            message:"Invalid request."
        });
    }

    if(!body || typeof body !== "object"){

        return res.status(400).json({
            message:"Invalid request."
        });
    }

    /*
       HONEYPOT
    */

    const website =
        cleanString(body.website,100);

    if(website){

        /*
           Return success instead of revealing
           that the request was identified as a bot.
        */

        return res.status(200).json({
            success:true,
            message:"Booking request received."
        });
    }

    /*
       CLEAN INPUT
    */

    const name =
        cleanString(body.name,100);

    const organisation =
        cleanString(body.organisation,150);

    const email =
        cleanString(body.email,254);

    const phone =
        cleanString(body.phone,30);

    const eventType =
        cleanString(body.eventType,100);

    const eventDate =
        cleanString(body.eventDate,20);

    const venue =
        cleanString(body.venue,200);

    const details =
        cleanString(body.details,3000);

    /*
       REQUIRED FIELD VALIDATION
    */

    if(name.length < 2){

        return res.status(400).json({
            message:"Please provide a valid name."
        });
    }

    if(!validEmail(email)){

        return res.status(400).json({
            message:"Please provide a valid email address."
        });
    }

    if(!validPhone(phone)){

        return res.status(400).json({
            message:"Please provide a valid phone number."
        });
    }

    if(!ALLOWED_EVENT_TYPES.has(eventType)){

        return res.status(400).json({
            message:"Invalid event type."
        });
    }

    if(!validDate(eventDate)){

        return res.status(400).json({
            message:"Please provide a valid event date."
        });
    }

    /*
       Prevent booking dates in the past.
    */

    const today =
        new Date();

    today.setHours(
        0,0,0,0
    );

    const requestedDate =
        new Date(
            `${eventDate}T00:00:00`
        );

    if(requestedDate < today){

        return res.status(400).json({
            message:
                "Please select a future event date."
        });
    }

    /*
       TURNSTILE
    */

    const turnstileToken =
        cleanString(
            body.turnstileToken,
            4000
        );

    const turnstile =
        await verifyTurnstile(
            turnstileToken,
            ip
        );

    if(!turnstile.success){

        return res.status(403).json({
            message:
                "Security verification failed. Please refresh the page and try again."
        });
    }

    /*
       FINAL BOOKING OBJECT
    */

    const booking = {

        name,
        organisation,
        email,
        phone,
        eventType,
        eventDate,
        venue,
        details

    };

    /*
       SEND EMAIL
    */

    try{

        await sendEmail(
            booking
        );

    }catch(error){

        console.error(
            "Booking processing failed."
        );

        return res.status(500).json({
            message:
                "Your request could not be processed right now. Please try again shortly."
        });
    }

    /*
       DO NOT return private information.
    */

    return res.status(200).json({

        success:true,

        message:
            "Your booking request has been received."

    });
};
