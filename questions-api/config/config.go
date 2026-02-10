package config

import (
	"bufio"
	"fmt"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// envExampleContract holds the embedded .env.example contract.
// Must be set via Init() before calling GetConfig().
var envExampleContract string

// Init sets the embedded .env.example contract string.
// Must be called once at application startup before GetConfig() is called.
// The contract should be embedded in the main package using //go:embed.
func Init(contract string) {
	envExampleContract = contract
}

/*
dotenv-safe formula (adapted for "file-to-file" org workflow)

Goal you specified:
- Each dev has `.env.example` (contract) and `.env` (actual).
- This script validates: `.env` satisfies `.env.example`.
- No hardcoded env var names; contract is the source of truth.

1) Separate loading from validation
   dotenv-safe: dotenv.config() loads `.env` into process env.
   Here: we "load" by parsing `.env` into envMap (map[string]string).
   Validation happens after loading by comparing required keys vs envMap.

   1A) Inject env vars from .env into the process env
       In THIS adaptation, we do NOT call os.Setenv.
       Instead, parseEnvFile(".env") -> envMap (represents the loaded environment).
       (Reason: you wanted validation of dev file contents, not OS env state.)
   1B) Parse embedded .env.example and treat keys as requiredKeys.
       The contract is compiled into the binary using Go's embed package,
       making the app self-contained and immune to missing files at runtime.
   1C) Compute set difference: requiredKeys - keys(envMap) => missing.

2) Define a contract source of truth (the embedded example file)
   `.env.example` is canonical for required variable NAMES.
   The file is embedded at compile time via //go:embed directive.

3) Decide how to treat empty values
   allowEmptyValues controls whether KEY="" counts as present.
   Policy implemented as: missing if !ok || (val=="" && !allowEmptyValues).

4) Compute missing keys by set difference
   missing = requiredKeys - presentKeys
   presentKeys come from envMap keys.

5) Fail fast with a high-signal error
   If missing, return a readable error that includes:
   - allowEmpty policy
   - .env path
   - embedded contract indicator
   - list of missing keys

   Note: dotenv-safe also reports underlying dotenv load error.
   Here we can report parse errors reading `.env` instead.

6) Return a useful config object, not just OK/FAIL
   - Return resolved map OR a Config struct.
   This repo expects config.GetConfig() to return a struct used by handlers,
   so we return Config after validation.

7) Defaults + overrides (dev vs CI)
   You said: no CI switching / no overrides.
   So we hardcode:
   - contract: embedded .env.example
   - env file: ".env"
   - allowEmptyValues: false
*/

// Config exists because handlers already expect a typed config object.
// We do NOT hardcode env var names; we derive env keys from field names:
//
//	RunnerContractVersion -> RUNNER_CONTRACT_VERSION
//	EnableLegacyRunner    -> ENABLE_LEGACY_RUNNER
//
// Add fields here as compile errors reveal new cfg.<Field> usages in handlers.
type Config struct {
	RunnerContractVersion string
	EnableLegacyRunner    bool

	// Commonly used elsewhere; harmless if unused (can delete if you want).
	NodeEnv string
	Port    int

	// MongoDB configuration
	MongoUri       string
	MongoDbContent string
	MongoDbApp     string
	MongoDbAppDev  string
	MongoDbAppStaging string

	// Supabase configuration
	SupabaseUrl            string
	SupabaseServiceRoleKey string
	SupabaseJwtSecret      string

	// Application configuration
	AppEnv         string
	AllowedOrigins string

	// Webhook secrets
	ReferralWebhookSecret  string
	WhitelistWebhookSecret string

	// Deployment metadata (optional, may be empty locally)
	GitCommitSha string
	DeployedAt   string
}

// GetConfig:
// - Step 1A (adapted): "load" .env by parsing it into envMap
// - Step 1B/2: parse embedded .env.example into requiredKeys (no file I/O)
// - Step 1C/3/4/5: validate requiredKeys against envMap (missing/empty policy)
// - Step 6: return a useful config object (typed Config) for the app
func GetConfig() Config {
	const envPath = ".env"
	const allowEmptyValues = false

	// (1A) Initialize envMap
	envMap := make(map[string]string)

	// Try to load .env file (Optional)
	fileMap, err := parseEnvFile(envPath)
	if err != nil {
		// If the error is anything OTHER than "file not found", crash.
		// If it IS "file not found", just log it and proceed (Cloud mode).
		if !os.IsNotExist(err) {
			fatal(fmt.Errorf("failed to parse env file %q: %w", envPath, err))
		}
		// Optional: Log that we are running without a .env file
		// fmt.Println("No .env file found; using system environment variables.")
	} else {
		// File exists, copy values into our map
		for k, v := range fileMap {
			envMap[k] = v
		}
	}

	// (CRITICAL FIX) Overlay System Environment Variables
	// This ensures AWS App Runner config is visible to your app.
	for _, raw := range os.Environ() {
		pair := strings.SplitN(raw, "=", 2)
		if len(pair) == 2 {
			envMap[pair[0]] = pair[1]
		}
	}

	// (1B/2) Contract: parse embedded .env.example -> requiredKeys (no file I/O needed)
	if envExampleContract == "" {
		fatal(fmt.Errorf("config.Init() must be called before GetConfig() - no embedded contract set"))
	}
	requiredKeys, err := readKeysFromExample()
	if err != nil {
		fatal(fmt.Errorf("failed to read embedded contract: %w", err))
	}
	if len(requiredKeys) == 0 {
		fatal(fmt.Errorf("embedded contract contained no keys"))
	}

	// (1C/3/4/5) Validate: requiredKeys vs envMap (now contains both File + System vars)
	if err := validateEnvMap(requiredKeys, envMap, envPath, allowEmptyValues); err != nil {
		fatal(err)
	}

	// (6) Return useful config object
	cfg, err := loadStructFromEnvMap[Config](envMap)
	if err != nil {
		fatal(err)
	}
	return cfg
}

// -------------------- Step 1C/3/4/5: Validation --------------------

func validateEnvMap(requiredKeys []string, envMap map[string]string, envPath string, allowEmpty bool) error {
	// (4) missing = requiredKeys - presentKeys (presentKeys derived from envMap)
	missing := make([]string, 0)
	for _, k := range requiredKeys {
		v, ok := envMap[k]
		// (3) empty policy
		if !ok || (!allowEmpty && v == "") {
			missing = append(missing, k)
		}
	}

	// (5) Fail fast with high-signal error
	if len(missing) > 0 {
		sort.Strings(missing)
		var b strings.Builder
		fmt.Fprintf(&b, "❌ .env does not satisfy contract (%d missing)\n", len(missing))
		fmt.Fprintf(&b, "contract: embedded .env.example\n")
		fmt.Fprintf(&b, "env file: %s\n", envPath)
		fmt.Fprintf(&b, "allowEmptyValues: %v\n", allowEmpty)
		b.WriteString("missing:\n")
		for _, k := range missing {
			fmt.Fprintf(&b, "  - %s\n", k)
		}
		b.WriteString("fix: add these keys to your .env (or set them via your runtime env).\n")
		return fmt.Errorf(b.String())
	}
	return nil
}

// -------------------- Step 1B/2: Contract parsing (embedded .env.example) --------------------

// readKeysFromExample extracts required variable names from the embedded .env.example contract.
// No file I/O needed since the contract is compiled into the binary.
func readKeysFromExample() ([]string, error) {
	keys := make([]string, 0, 32)
	seen := make(map[string]bool, 64)

	// Read from the embedded string variable
	sc := bufio.NewScanner(strings.NewReader(envExampleContract))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		i := strings.IndexByte(line, '=')
		if i <= 0 {
			continue
		}
		k := strings.TrimSpace(line[:i])
		if k == "" {
			continue
		}
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return keys, nil
}

// -------------------- Step 1A (adapted): "Load" .env into envMap --------------------

// parseEnvFile parses .env into a map (KEY -> VALUE).
// Supports basic KEY=VALUE lines, ignores comments/blank lines, strips simple quotes.
func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	out := make(map[string]string, 64)
	sc := bufio.NewScanner(f)

	for sc.Scan() {
		raw := strings.TrimSpace(sc.Text())
		if raw == "" || strings.HasPrefix(raw, "#") {
			continue
		}
		if strings.HasPrefix(raw, "export ") {
			raw = strings.TrimSpace(strings.TrimPrefix(raw, "export "))
		}
		i := strings.IndexByte(raw, '=')
		if i <= 0 {
			continue
		}
		k := strings.TrimSpace(raw[:i])
		v := strings.TrimSpace(raw[i+1:])
		v = stripQuotes(v)
		if k != "" {
			out[k] = v
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func stripQuotes(v string) string {
	if len(v) >= 2 {
		if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
			return v[1 : len(v)-1]
		}
	}
	return v
}

// -------------------- Step 6: Build typed Config (no hardcoded env keys) --------------------

// loadStructFromEnvMap fills struct fields by converting field name -> SCREAMING_SNAKE env key.
// Example: RunnerContractVersion -> RUNNER_CONTRACT_VERSION
func loadStructFromEnvMap[T any](envMap map[string]string) (T, error) {
	var out T
	val := reflect.ValueOf(&out).Elem()
	typ := val.Type()

	for i := 0; i < val.NumField(); i++ {
		sf := typ.Field(i)
		fv := val.Field(i)

		envKey := camelToScreamingSnake(sf.Name)
		raw := envMap[envKey] // validation ensures required keys exist if they are in the contract

		switch fv.Kind() {
		case reflect.String:
			fv.SetString(raw)

		case reflect.Bool:
			fv.SetBool(isTruthy(raw))

		case reflect.Int:
			if raw == "" {
				fv.SetInt(0)
				continue
			}
			n, err := strconv.Atoi(raw)
			if err != nil {
				return out, fmt.Errorf("%s must be int (got %q)", envKey, raw)
			}
			fv.SetInt(int64(n))

		default:
			return out, fmt.Errorf("unsupported field type %s for %s", fv.Kind(), sf.Name)
		}
	}
	return out, nil
}

func isTruthy(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	return s == "1" || s == "true" || s == "yes" || s == "y" || s == "on"
}

var camelBoundary = regexp.MustCompile(`([a-z0-9])([A-Z])`)

func camelToScreamingSnake(s string) string {
	withUnderscores := camelBoundary.ReplaceAllString(s, `${1}_${2}`)
	return strings.ToUpper(withUnderscores)
}

// fatal prints the error and exits (fail fast).
// Keep dependency-light (no log import required).
func fatal(err error) {
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}
