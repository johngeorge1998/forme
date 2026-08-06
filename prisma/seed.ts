import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const dataPath = path.join(__dirname, '../../free-exercise-db-with-videos/data/exercises.json');
  if (!fs.existsSync(dataPath)) {
    console.error('exercises.json not found!');
    return;
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`Loaded ${data.length} exercises from JSON`);

  for (const item of data) {
    await prisma.exercise.create({
      data: {
        id: item.id,
        name: item.name,
        bodyPart: item.bodyPart,
        category: item.target || 'UNKNOWN',
        videos: item.videos || {},
        thumbnails: item.thumbnails || {},
        instructions: item.instructions || [],
      }
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
