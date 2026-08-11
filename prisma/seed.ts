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

  // Batch insert with skipDuplicates for idempotent re-runs.
  // ~100x faster than individual creates for large datasets.
  const result = await prisma.exercise.createMany({
    data: data.map((item: any) => ({
      id: item.id,
      name: item.name,
      primaryMuscle: item.bodyPart || 'UNKNOWN',
      secondaryMuscles: [],
      category: item.target || 'UNKNOWN',
      videos: item.videos || {},
      thumbnails: item.thumbnails || {},
      instructions: item.instructions || [],
    })),
    skipDuplicates: true,
  });

  console.log(`Database seeded successfully! ${result.count} exercises inserted.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
