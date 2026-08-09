const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  jwt: {
    secret: requireEnv('JWT_SECRET'),
    refreshSecret: requireEnv('REFRESH_TOKEN_SECRET'),
    accessExpiresIn: '15m' as const,
    refreshExpiresInDays: 30,
  },
  server: {
    port: Number(process.env.PORT) || 4000,
  },
  weight: {
    KG_TO_LBS: 2.20462,
  },
} as const;
