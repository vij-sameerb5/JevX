import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import { Banner } from "./components.js";

export interface MenuItem {
  id: string;
  label: string;
  hint: string;
}

export function WelcomeScreen({
  items,
  version,
  onSelect
}: {
  items: MenuItem[];
  version: string;
  onSelect: (id: string | undefined) => void;
}) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      onSelect(undefined);
      exit();
    }
  });

  const width = Math.max(...items.map((i) => i.label.length)) + 3;
  return (
    <Box flexDirection="column">
      <Banner />
      <Text color="gray">v{version} · finds hardcoded text-matching logic and turns it into TypeSafe AI calls</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items.map((i) => ({ key: i.id, value: i.id, label: i.hint ? `${i.label.padEnd(width)}${i.hint}` : i.label }))}
          onSelect={(item) => {
            onSelect(item.value);
            exit();
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑/↓ Select   Enter Run   Q Quit</Text>
      </Box>
    </Box>
  );
}
