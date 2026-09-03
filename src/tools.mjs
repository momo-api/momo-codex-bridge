function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeName(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function toFunction(tool, namespace) {
  if (!tool || typeof tool !== "object") return null;
  const rawName = tool.name || tool.function?.name;
  if (!rawName) return null;
  const name = namespace ? `${safeName(namespace)}__${safeName(rawName)}` : safeName(rawName);
  const custom = tool.type === "custom";
  const parameters = custom
    ? {
      type: "object",
      properties: {
        input: { type: "string", description: "The complete raw input for this custom tool. Do not wrap it in JSON." },
      },
      required: ["input"],
      additionalProperties: false,
    }
    : tool.parameters || tool.input_schema || tool.function?.parameters || { type: "object", properties: {} };
  return {
    name,
    originalName: String(rawName),
    namespace: namespace || null,
    kind: custom ? "custom" : "function",
    description: custom
      ? `${tool.description || "Codex custom tool"}\nReturn the complete freeform payload in the required input string exactly as the tool expects.`
      : tool.description || tool.function?.description || "Codex tool",
    parameters,
  };
}

export function extractFunctions(request) {
  const result = [];
  const visit = (tool, namespace = null) => {
    if (!tool || typeof tool !== "object") return;
    if (tool.type === "namespace") {
      for (const child of asArray(tool.tools)) visit(child, tool.namespace || tool.name || namespace);
      return;
    }
    if (tool.type === "function" || tool.function?.name || tool.name) {
      const converted = toFunction(tool, namespace);
      if (converted) result.push(converted);
    }
  };
  for (const tool of [...asArray(request.tools), ...asArray(request.additional_tools)]) visit(tool);
  return [...new Map(result.map((tool) => [tool.name, tool])).values()];
}

export function restoreToolName(name, functions) {
  return functions.find((tool) => tool.name === name) || { name, originalName: name, namespace: null };
}
