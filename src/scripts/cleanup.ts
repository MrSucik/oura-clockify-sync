import { validateEnvironment } from '../config/env';
import { createClockifyService } from '../services/clockify-service';
import { getErrorMessage, sleep } from '../utils/common';
import type { ClockifyTimeEntry } from '../types/clockify';

// Validate environment on startup
const env = validateEnvironment();

async function cleanupSleepEntries(): Promise<void> {
  console.log('🧹 Oura Sleep Tracker Cleanup Tool');
  console.log('⚠️  WARNING: This will delete ALL sleep entries from Clockify!\n');

  try {
    // Initialize Clockify service
    const clockifyService = createClockifyService(env.CLOCKIFY_API_TOKEN);
    await clockifyService.initialize();

    // Get all time entries (last 2 years should be enough)
    const endDate = new Date().toISOString().split('T')[0];
    const startDateObj = new Date();
    startDateObj.setFullYear(startDateObj.getFullYear() - 2);
    const startDate = startDateObj.toISOString().split('T')[0];

    console.log(`📊 Fetching time entries from ${startDate} to ${endDate}...`);
    const allEntries = await clockifyService.getTimeEntriesForDateRange(startDate, endDate);

    // Filter for sleep entries
    const sleepEntries = allEntries.filter(
      (entry: ClockifyTimeEntry) => entry.description.includes('🛌 Sleep') || entry.description.includes('[Oura:')
    );

    if (sleepEntries.length === 0) {
      console.log('✅ No sleep entries found to delete.');
      return;
    }

    console.log(`\n❗ Found ${sleepEntries.length} sleep entries to delete:`);
    sleepEntries.slice(0, 5).forEach((entry: ClockifyTimeEntry) => {
      console.log(`   - ${entry.description.substring(0, 60)}...`);
    });

    if (sleepEntries.length > 5) {
      console.log(`   ... and ${sleepEntries.length - 5} more`);
    }

    // Countdown before deletion
    console.log('\n⏰ Starting deletion in 10 seconds...');
    console.log('Press Ctrl+C to cancel!');

    for (let i = 10; i > 0; i--) {
      process.stdout.write(`\r⏳ ${i} seconds remaining...`);
      await sleep(1000);
    }

    console.log('\n\n🗑️  Starting deletion process...\n');

    let deletedCount = 0;
    let failedCount = 0;

    for (const entry of sleepEntries) {
      try {
        await clockifyService.deleteTimeEntry(entry.id);
        deletedCount++;
        console.log(
          `✅ Deleted entry ${deletedCount}/${sleepEntries.length}: ${entry.description.substring(0, 50)}...`
        );

        // Add delay to avoid rate limiting
        await sleep(env.CLOCKIFY_API_DELAY);
      } catch (error: unknown) {
        failedCount++;
        const errorMessage = getErrorMessage(error);
        console.error(`❌ Failed to delete entry: ${errorMessage}`);

        // If we hit rate limit, wait longer
        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
          console.log('⏸️  Rate limit hit, waiting 200ms...');
          await sleep(200);
        }
      }
    }

    console.log(`\n🎉 Cleanup complete!`);
    console.log(`   - Total entries found: ${sleepEntries.length}`);
    console.log(`   - Successfully deleted: ${deletedCount}`);
    console.log(`   - Failed to delete: ${failedCount}`);

    if (failedCount > 0) {
      console.log('\n⚠️  Some entries failed to delete. You can run this script again to retry.');
    } else {
      console.log('\n✨ All sleep entries have been successfully removed from Clockify.');
    }
  } catch (error: unknown) {
    console.error('\n❌ Cleanup failed:', getErrorMessage(error));
    process.exit(1);
  }
}

// Run cleanup
cleanupSleepEntries().catch(console.error);
