package main

import _ "embed"

// EnvExampleContract contains the embedded .env.example file contents.
// This makes the app self-contained and immune to missing contract files at runtime.
//
//go:embed .env.example
var envExampleContract string
