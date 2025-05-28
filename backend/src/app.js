import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// Seguridad HTTP
app.use(helmet());
// Permitir CORS
app.use(cors());
// Parseo de JSON
app.use(express.json());
// Logging de requests
app.use(morgan('dev'));

// Rutas (se agregarán routers específicos más adelante)
// app.use('/api/messages', messagesRouter);
// app.use('/api/config', configRouter);
// app.use('/api/dashboard', dashboardRouter);
// app.use('/api/orders', ordersRouter);
// app.use('/api/customers', customersRouter);
// app.use('/api/escalations', escalationsRouter);

// Middleware de manejo de errores
app.use(errorHandler);

export default app; 