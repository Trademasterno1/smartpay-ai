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
- A Gemini API key for live AI responses

## Run locally

1. Clone this repository.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`.
4. Add your PayPal Sandbox Client ID and Secret to `.env`.
5. Add a Gemini API key to enable the AI assistant.
6. Start the server with `npm start`.
7. Open http://localhost:3000.

## Environment variables

| Variable | Description |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal Sandbox REST app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox secret; server-side only |
| `PAYPAL_ENV` | Use `sandbox` for testing |
| `GEMINI_API_KEY` | Gemini API key for AI responses |
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
- The AI endpoint requires a configured Gemini API key.
- This is a hackathon prototype, not a production financial service.

## Technology

Node.js, Express, PayPal Orders REST API, PayPal JavaScript SDK, Google Gemini API.

## License

MIT. See [LICENSE](LICENSE).
