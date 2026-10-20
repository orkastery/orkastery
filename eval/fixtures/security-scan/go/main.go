package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"os/exec"

	"golang.org/x/text/language"
)

func handler(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	// Command injection: user input reaches a shell.
	out, _ := exec.Command("sh", "-c", "ls "+r.URL.Query().Get("dir")).Output()
	// SQL injection: user input is concatenated into the query.
	rows, _ := db.Query("SELECT name FROM users WHERE id = " + r.URL.Query().Get("id"))
	if rows != nil {
		defer rows.Close()
	}
	// Vulnerable function called: ParseAcceptLanguage (CVE-2022-32149).
	tags, _, _ := language.ParseAcceptLanguage(r.Header.Get("Accept-Language"))
	os.Remove("/tmp/fixture-go")
	fmt.Fprintf(w, "%s %v %s", out, tags, apiKey)
}

func main() {
	db, _ := sql.Open("sqlite3", ":memory:")
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { handler(w, r, db) })
	_ = http.ListenAndServe(":8080", nil)
}
