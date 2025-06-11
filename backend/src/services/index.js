import { EnhancedAIRouter } from './enhancedAIRouter.js';
import { Groq } from 'groq-sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Create singleton instance
const enhancedAIRouter = new EnhancedAIRouter();

// Configure AI APIs if keys are present
if (process.env.GROQ_API_KEY) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  enhancedAIRouter.setGroq(groq);
}
if (process.env.OPENAI_API_KEY) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  enhancedAIRouter.setOpenAI(openai);
}
if (process.env.GEMINI_API_KEY) {
  const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  enhancedAIRouter.setGemini(gemini);
}

export { enhancedAIRouter }; 