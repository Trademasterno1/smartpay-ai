# SmartPay AI

AI-powered payment and invoice assistant for small businesses, built for the PayPal AI Hackathon.

## What it does

- Tracks sample invoices and their payment status.
- Creates and captures PayPal Sandbox orders from an invoice.
- Provides an AI assistant grounded in the invoice data.
- Highlights unpaid and overdue invoices.

> The dashboard starts with clearly labelled sample data. PayPal Sandbox uses test transactions only; no real money is moved.

## Requirements

- Node.js 20 or newer
- A PayPal Developer Sandbox REST app
- A Groq API key for primary AI responses (Gemini is optional fallback)

## Run locally

1. Clone this repository.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`.
4. Add your PayPal Sandbox Client ID and Secret to `.env`.
5. Add a Groq API key for the primary AI assistant. Add a Gemini API key if you want automatic fallback.
6. Start the server with `npm start`.
7. Open http://localhost:3000.

## Environment variables

| Variable | Description |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal Sandbox REST app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox secret; server-side only |
| `PAYPAL_ENV` | Use `sandbox` for testing |
| `GROQ_API_KEY` | Groq API key for primary AI responses |\n| `GROQ_MODEL` | Optional Groq model ID (default: `llama-3.3-70b-versatile`) |\n| `GEMINI_API_KEY` | Optional Gemini fallback API key |
| `PORT` | Optional server port (default 3000) |

Never commit your `.env` file or expose the PayPal Secret in browser code.

## Demo flow

1. Open the dashboard and inspect the sample invoice list.
2. Choose an unpaid invoice and select **Pay with PayPal**.
3. Complete the payment using a PayPal Sandbox Personal test account.
4. Return to the dashboard and confirm the invoice status.
5. Ask the AI assistant which invoices are overdue or what needs follow-up.

## Current prototype limitations

- Invoice data is in memory and resets when the server restarts.
- The dashboard uses sample invoice data, not a production accounting system.
- The AI endpoint uses Groq when `GROQ_API_KEY` is configured and falls back to Gemini when available; otherwise Gemini is used directly.
- This is a hackathon prototype, not a production financial service.

## Technology

Node.js, Express, PayPal Orders REST API, PayPal JavaScript SDK, Groq API with optional Google Gemini fallback.

## License

MIT. See [LICENSE](LICENSE).
