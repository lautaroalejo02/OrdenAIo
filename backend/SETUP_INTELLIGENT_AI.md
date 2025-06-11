# 🧠 Intelligent AI Order Processing Setup

## Overview
This project has been upgraded to use OpenAI's GPT-4o for true natural language understanding, replacing the old regex-based system.

## Required Configuration

### 1. Environment Variables
Create a `.env` file in the backend directory with:

```bash
# Database
DATABASE_URL="your_postgresql_connection_string"

# OpenAI API (REQUIRED for intelligent order processing)
OPENAI_API_KEY="your_openai_api_key_here"

# Alternative AI Services (optional fallbacks)
GROQ_API_KEY="your_groq_api_key_here"
GEMINI_API_KEY="your_gemini_api_key_here"

# Application Settings
APP_URL="http://localhost:5173"
PORT=5000
NODE_ENV="development"

# WhatsApp (uses QR code authentication)
```

### 2. OpenAI API Key Setup

1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Add it to your `.env` file as `OPENAI_API_KEY`
4. Ensure you have sufficient credits in your OpenAI account

### 3. What Changed

#### Old System (Regex-based)
- Used simple pattern matching
- Failed with complex orders like "una docena de empanadas de pollo"
- Added wrong quantities to wrong products
- No true understanding of context

#### New System (AI-powered)
- Uses OpenAI GPT-4o for true natural language understanding
- Precisely extracts quantities and products
- Understands Spanish expressions like "una docena", "media docena", "docena y media"
- Handles complex orders correctly
- Asks for clarification when needed
- Maintains conversation context

### 4. Example Conversations

**Old System Error:**
```
User: "Quiero una docena de empanadas de pollo"
Bot: ✅ Agregué a tu pedido:
• 12x Empanadas de pollo
• 12x Empanadas de carne ❌ WRONG!
```

**New System (Correct):**
```
User: "Quiero una docena de empanadas de pollo"
Bot: ✅ Perfecto! Agregué a tu pedido:
• 12x Empanadas de pollo ($144.00)
Total parcial: $144.00
¿Querés agregar algo más o confirmar el pedido?
```

### 5. Files Modified

- `backend/src/services/intelligentOrderProcessor.js` - NEW: AI-powered processor
- `backend/src/whatsapp/messageHandler.js` - Updated to use intelligent processor
- `backend/package.json` - OpenAI dependency already included

### 6. Cost Considerations

OpenAI API calls cost approximately:
- $0.005 per 1K input tokens
- $0.015 per 1K output tokens
- Average order: ~$0.01-0.02 per processed message

For a small restaurant, this translates to roughly $10-30/month for AI processing.

### 7. Testing

Test these examples to verify the intelligent system:

```
"Quiero una docena de empanadas de pollo"
"Media docena de carne y media de pollo"
"2 pizzas margarita"
"Una empanada" (should ask for clarification)
"Confirmar" (should confirm current order)
"Menú" (should show menu)
```

### 8. Fallback

If OpenAI is not available, the system will:
1. Show an error message
2. Ask the user to try again
3. Maintain basic greeting functionality

### 9. Monitoring

Check logs for:
- `🧠 AI Response:` - OpenAI processing results
- `OPENAI_API_KEY` environment variable presence
- API call success/failure messages

The new system should dramatically improve order accuracy and customer experience! 🚀 