# Frontend Implementation Guide & API Reference

This document serves as a comprehensive guide for mobile and frontend developers to understand the backend APIs, their functionalities, and specific business logic (like timers) required for the fitness application.

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [Timer Logic (Crucial for Frontend)](#timer-logic)
3. [API Modules](#api-modules)
   - [Authentication](#1-authentication)
   - [Profile](#2-profile)
   - [Exercises](#3-exercises)
   - [Routines](#4-routines)
   - [Workouts (Active Session)](#5-workouts-active-session)
   - [Progress & Stats](#6-progress--stats)

---

## Core Concepts

- **Weight Units**: The backend handles user weight preferences (`KG` or `LBS`). The backend stores weights internally as `KG` in the database, but API responses automatically convert weight values and include a `weightUnit` field based on the user's profile settings.
- **Authentication**: All endpoints (except `/api/auth/register`, `/login`, `/refresh`) require a Bearer token in the `Authorization` header.

---

## Timer Logic

The mobile app must handle three distinct types of timers locally. The backend stores the results but does not enforce real-time ticking.

### 1. Overall Workout Timer (Duration)
- **Start**: When the user taps "Start Workout", record the current timestamp locally (`startTime`). 
- **API Call**: Send this `startTime` to `POST /api/workouts`.
- **UI**: Display a running stopwatch (e.g., `00:15:30`) calculated as `Date.now() - startTime`.
- **Finish**: When the user taps "Finish", compute `durationSec` (elapsed seconds) and the current timestamp (`endTime`). Send these to `POST /api/workouts/:id/finish`. (If `durationSec` is omitted, the backend will calculate it automatically using `endTime - startTime`).

### 2. Automatic Rest Timer
- **Configuration**: Routines have an `automaticRestTimer` boolean flag, and individual exercises within a routine have a `restSeconds` value.
- **Trigger**: When the user marks a set as complete (checking it off), the frontend calls `PUT /api/workouts/:id/sets/:setId` with `isCompleted: true`.
- **Action**: 
  - Immediately check if the routine's `automaticRestTimer` is `true` AND the exercise's `restSeconds > 0`.
  - If so, pop up a countdown timer UI for the specified `restSeconds`.
  - When the timer reaches zero, play a sound/vibrate to alert the user to start the next set.
- *Note*: This is purely a frontend UX feature. The backend does not track rests.

### 3. Time-Based Exercise Timer (Sets)
- **Configuration**: Exercises like planks or cardio have a `targetTimeSeconds` instead of (or alongside) `targetReps`.
- **UI**: The frontend should provide a stopwatch/countdown inside the active set row.
- **Action**: When the user finishes the set, the actual elapsed time should be sent as `timeSeconds` in the `PUT /api/workouts/:id/sets/:setId` payload.

---

## API Modules

### 1. Authentication
Endpoint prefix: `/api/auth`

| Method | Endpoint | Payload | Description |
|--------|----------|---------|-------------|
| POST | `/register` | `{ email, password, fullName }` | Registers a new user. Returns user object, `token`, and `refreshToken`. |
| POST | `/login` | `{ email, password }` | Authenticates user. Returns user, `token`, and `refreshToken`. |
| POST | `/refresh` | `{ refreshToken }` | Generates a new access token. |
| POST | `/logout` | `{ refreshToken }` | Revokes the refresh token. |


### 2. Profile
Endpoint prefix: `/api/profile`

| Method | Endpoint | Payload | Description |
|--------|----------|---------|-------------|
| GET | `/` | None | Returns the user profile along with aggregated stats (workouts completed, total volume). |
| POST | `/weight-unit` | `{ weightUnit: 'KG' \| 'LBS' }` | Updates the user's preferred weight unit. Subsequent API responses will convert weights accordingly. |


### 3. Exercises
Endpoint prefix: `/api/exercises`

| Method | Endpoint | Payload / Query | Description |
|--------|----------|-----------------|-------------|
| GET | `/` | Query: `search, muscleGroup, equipment, limit, offset` | Fetches the exercise library. Supports pagination (returns `hasNext` flag). Injects `videos` and `thumbnails` directly based on the user's gender. |
| GET | `/:id` | None | Fetches details for a single exercise. |
| POST | `/` | `{ name, primaryMuscle, secondaryMuscles?, category?, instructions? }` | Creates a custom exercise specific to the logged-in user. |
| PUT | `/:id` | `{ name?, primaryMuscle?, secondaryMuscles?, category?, instructions? }` | Updates a custom exercise. |
| DELETE | `/:id` | None | Deletes a custom exercise. |



**Detailed Muscle Groups (`primaryMuscle` / `secondaryMuscles`)**:
To provide precise tracking, the frontend should send specific muscle names from the following comprehensive list:

- **Chest**: `'pectoralis-major'` (Pectoralis Major), `'pectoralis-minor'` (Pectoralis Minor), `'serratus-anterior'` (Serratus Anterior)
- **Back**: `'latissimus-dorsi'` (Latissimus Dorsi), `'rhomboids'` (Rhomboids), `'trapezius'` (Trapezius), `'erector-spinae'` (Erector Spinae), `'teres-major'` (Teres Major), `'infraspinatus'` (Infraspinatus)
- **Shoulders**: `'anterior-deltoid'` (Anterior Deltoid), `'lateral-deltoid'` (Lateral Deltoid), `'posterior-deltoid'` (Posterior Deltoid), `'rotator-cuff'` (Rotator Cuff)
- **Arms**: `'biceps-brachii'` (Biceps Brachii), `'brachialis'` (Brachialis), `'triceps-brachii'` (Triceps Brachii), `'forearms'` (Forearms), `'wrist-flexors'` (Wrist Flexors), `'wrist-extensors'` (Wrist Extensors)
- **Legs**: `'quadriceps'` (Quadriceps), `'hamstrings'` (Hamstrings), `'gluteus-maximus'` (Gluteus Maximus), `'gluteus-medius'` (Gluteus Medius), `'gluteus-minimus'` (Gluteus Minimus), `'calves'` (Calves), `'gastrocnemius'` (Gastrocnemius), `'soleus'` (Soleus), `'adductors'` (Adductors), `'abductors'` (Abductors), `'hip-flexors'` (Hip Flexors)
- **Core**: `'rectus-abdominis'` (Rectus Abdominis), `'transverse-abdominis'` (Transverse Abdominis), `'obliques'` (Obliques)
- **Other**: `'neck'` (Neck), `'full-body'` (Full Body), `'cardio'` (Cardio)

### 4. Routines
Endpoint prefix: `/api/routines`

| Method | Endpoint | Payload | Description |
|--------|----------|---------|-------------|
| GET | `/` | None | Fetches all user routines. Automatically calculates and injects `pr` (Personal Record) and `est1RM` (Estimated 1-Rep Max) for every exercise within the routines. |
| POST | `/` | `{ name, notes?, automaticRestTimer?, exercises: [ { exerciseId, order, targetSets, targetReps, targetTimeSeconds, targetDistance, restSeconds } ] }` | Creates a new routine. Max limit: 6 routines per user. |
| PUT | `/:id` | Same as POST | Updates an existing routine. Replaces the old exercises with the new array provided. |
| GET | `/:id` | None | Fetches details of a specific routine. |
| DELETE | `/:id` | None | Deletes a routine. |


### 5. Workouts (Active Session)
Endpoint prefix: `/api/workouts`

This module is used to log an active workout session.

| Method | Endpoint | Payload | Description |
|--------|----------|---------|-------------|
| POST | `/` | `{ routineId?, notes?, startTime, exercises? }` | Starts a workout. If `routineId` is provided without `exercises`, it auto-generates the exercises and empty sets based on the routine template. Returns the `WorkoutSession` object with `id` to be used for subsequent calls. |
| GET | `/` | Query: `limit, offset` | Fetches workout history (finished workouts). |
| GET | `/:id` | None | Fetches details of a specific past workout session. |
| POST | `/:id/workout-exercises` | `{ exerciseId, order }` | Adds an ad-hoc exercise to an ongoing workout session. Auto-generates the first empty set. |
| POST | `/:id/workout-exercises/:workoutExerciseId/sets` | None | Adds a new empty set to a specific exercise in the active workout. |
| DELETE | `/:id/workout-exercises/:workoutExerciseId` | None | Removes an exercise from the active workout. |
| PUT | `/:id/workout-exercises/:workoutExerciseId` | `{ notes }` | Saves user notes for a specific exercise within the workout. |
| PUT | `/:id/sets/:setId` | `{ weightKg?, reps?, timeSeconds?, distance?, isCompleted? }` | Logs or updates a specific set. **Crucial:** Set `isCompleted: true` when the user checks off the set. This is where frontend rest timers should trigger. |
| DELETE | `/:id/sets/:setId` | None | Deletes a specific set. |
| POST | `/:id/finish` | `{ endTime, durationSec, notes? }` | Finishes the workout session. Aggregates total volume based on completed sets. |


### 6. Progress & Stats
Endpoint prefix: `/api/progress`

| Method | Endpoint | Payload | Description |
|--------|----------|---------|-------------|
| GET | `/stats` | None | Dashboard statistics. Returns `weeklyVolume`, `focusTimeHours`, `streak` (consecutive days), and `chartData` (daily volume for the last 7 days), along with recent activity. |
| GET | `/1rm/:exerciseId` | None | Returns historical Estimated 1-Rep Max data for line charts. |
| GET | `/exercise-stats/:exerciseId` | None | Returns all-time stats for a specific exercise: `currentMax`, `est1RM`, `maxTimeSeconds`, `maxDistance`, `totalReps`. |
| GET | `/records` | None | Returns the top 3 overall Personal Records (by weight, time, or distance) across all exercises the user has performed. |
