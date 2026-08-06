import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import authRoutes from './routes/auth';
import exerciseRoutes from './routes/exercises';
import routineRoutes from './routes/routines';
import workoutRoutes from './routes/workouts';
import progressRoutes from './routes/progress';

const app = express();

// Security and utility middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());

// Serve downloaded videos and thumbnails from the parent repo
const videosPath = path.join(__dirname, '../../free-exercise-db-with-videos/videos');
const thumbnailsPath = path.join(__dirname, '../../free-exercise-db-with-videos/thumbnails');

app.use('/videos', express.static(videosPath));
app.use('/thumbnails', express.static(thumbnailsPath));

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/exercises', exerciseRoutes);
app.use('/api/v1/routines', routineRoutes);
app.use('/api/v1/workouts', workoutRoutes);
app.use('/api/v1/progress', progressRoutes);

import { sendSuccess, sendError } from './utils/response';

// Health check
app.get('/health', (req, res) => {
  sendSuccess(res, { timestamp: new Date().toISOString() }, 'ok', 200);
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const data = process.env.NODE_ENV === 'development' ? { stack: err.stack } : null;
  
  sendError(res, message, status, data);
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;
