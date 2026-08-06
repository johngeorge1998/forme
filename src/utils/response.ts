import { Response } from 'express';

interface MetaData {
  hasNext?: boolean;
  total?: number;
  [key: string]: any;
}

export const sendSuccess = (
  res: Response,
  data: any = null,
  message: string = 'Success',
  statusCode: number = 200,
  meta?: MetaData
) => {
  const response: any = {
    success: true,
    message,
    data,
  };

  if (meta) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  message: string = 'Internal Server Error',
  statusCode: number = 500,
  data: any = null
) => {
  const response: any = {
    success: false,
    message,
  };

  if (data) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};
