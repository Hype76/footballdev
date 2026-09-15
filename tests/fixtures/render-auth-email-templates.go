package main

import (
  "bytes"
  "encoding/json"
  "html/template"
  "os"
)

type Input struct {
  Template string `json:"template"`
  Data map[string]interface{} `json:"data"`
}

func main() {
  var inputs []Input
  if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil { panic(err) }
  results := make([]string, 0, len(inputs))
  for _, input := range inputs {
    parsed, err := template.New("auth").Parse(input.Template)
    if err != nil { panic(err) }
    var output bytes.Buffer
    if err := parsed.Execute(&output, input.Data); err != nil { panic(err) }
    results = append(results, output.String())
  }
  if err := json.NewEncoder(os.Stdout).Encode(results); err != nil { panic(err) }
}
