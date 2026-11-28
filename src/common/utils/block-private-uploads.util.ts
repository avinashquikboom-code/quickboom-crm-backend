import type { NextFunction, Request, Response } from 'express';
import { posix } from 'path';

/**
 * Stops the public /uploads static folder from serving private candidate resumes.
 * HR downloads them through the authenticated hiring API instead.
 */
export function blockPrivateUploads(req: Request, res: Response, next: NextFunction) {
  let target: string;
  try {
    // Decode and normalise first, the same way the static file server resolves paths.
    target = posix.normalize(decodeURIComponent(req.path)).toLowerCase();
  } catch {
    return res.status(404).end();
  }
  if (target === '/private-resumes' || target.startsWith('/private-resumes/')) {
    return res.status(404).end();
  }
  return next();
}
