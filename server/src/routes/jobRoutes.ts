import { Router } from 'express';
import {
  createJob,
  listJobs,
  getJobById,
  getJobStats,
  deleteJob,
  retryJob
} from '../controllers/jobController';
import { authenticate } from '../middleware/auth';
import { jobSubmissionRateLimiter } from '../middleware/submissionControls';

export const jobRouter = Router();

// All job management endpoints require authentication
jobRouter.use(authenticate);

jobRouter.post('/', jobSubmissionRateLimiter, createJob);
jobRouter.get('/', listJobs);
jobRouter.get('/stats', getJobStats);
jobRouter.post('/:id/retry', retryJob);
jobRouter.get('/:id', getJobById);
jobRouter.delete('/:id', deleteJob);
