import '@architect-os/sandbox/require-run';
// A production builder session starts inside an admitted Step.
process.stderr.write('architect-os code: STEP_ADMISSION_REQUIRED. Start the approved Step instead.\n');
process.exitCode = 2;
