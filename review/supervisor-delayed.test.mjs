// Runs the supervisor tests again with delayed stand-ins (see SUPERVISOR_TEST_DELAY_MS in
// supervisor.test.mjs), so event synchronization races fail deterministically instead of rarely (#97).
process.env.SUPERVISOR_TEST_DELAY_MS='400';
await import('./supervisor.test.mjs');
