import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler.js';
import messagesRouter from './routes/messages.js';
import configRouter from './routes/config.js';
import dashboardRouter from './routes/dashboard.js';
import ordersRouter from './routes/orders.js';
import customersRouter from './routes/customers.js';
import escalationsRouter from './routes/escalations.js';
import keywordsRouter from './routes/keywords.js';
import menuRouter from './routes/menu.js';
import aiAdminRoutes from './routes/aiAdmin.js';

const app = express();

// HTTP security headers
app.use(helmet());

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://ordenalo-front-production.up.railway.app',
      'https://ordenaio-production.up.railway.app', // Handle the typo in case it exists
      'https://ordenalo-production.up.railway.app'
    ];
    
    // Check if origin is in allowed list or is a Railway app domain
    if (allowedOrigins.includes(origin) || origin.includes('.up.railway.app')) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// JSON body parsing
app.use(express.json());
// Request logging
app.use(morgan('dev'));

// Register API routes
app.use('/api/messages', messagesRouter);
app.use('/api/config', configRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/customers', customersRouter);
app.use('/api/escalations', escalationsRouter);
app.use('/api/keywords', keywordsRouter);
app.use('/api/menu', menuRouter);
app.use('/api/admin', aiAdminRoutes);

// Centralized error handler
app.use(errorHandler);

export default app; 