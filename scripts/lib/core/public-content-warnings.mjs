export function validatePublicSensitiveContentRules(rulesConfig, sourceLabel = "public-sensitive-content-rules") {
  const errors = [];
  if (!rulesConfig || typeof rulesConfig !== "object" || Array.isArray(rulesConfig)) {
    return [`${sourceLabel}: root must be an object`];
  }

  if (!Array.isArray(rulesConfig.public_text_fields)) {
    errors.push(`${sourceLabel}: public_text_fields must be an array`);
  } else {
    const seenFields = new Set();
    for (const field of rulesConfig.public_text_fields) {
      const normalizedField = String(field ?? "").trim();
      if (!normalizedField) {
        errors.push(`${sourceLabel}: public_text_fields must not contain blank field names`);
      } else if (seenFields.has(normalizedField)) {
        errors.push(`${sourceLabel}: public_text_fields has duplicate field "${normalizedField}"`);
      }
      seenFields.add(normalizedField);
    }
  }

  if (!Array.isArray(rulesConfig.rules)) {
    errors.push(`${sourceLabel}: rules must be an array`);
    return errors;
  }

  const seenRuleIds = new Set();
  for (const [index, rule] of rulesConfig.rules.entries()) {
    const prefix = `${sourceLabel}: rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const key of ["id", "label_zh", "pattern"]) {
      if (!String(rule[key] ?? "").trim()) {
        errors.push(`${prefix}.${key} must not be blank`);
      }
    }
    if (seenRuleIds.has(rule.id)) {
      errors.push(`${sourceLabel}: duplicate rule id "${rule.id}"`);
    }
    seenRuleIds.add(rule.id);
    try {
      new RegExp(rule.pattern, rule.flags ?? "");
    } catch (error) {
      errors.push(`${prefix}.pattern is not a valid RegExp: ${error.message}`);
    }
  }

  return errors;
}

export function publicSensitiveContentWarnings(record, rulesConfig) {
  const fields = rulesConfig?.public_text_fields ?? [];
  const rules = rulesConfig?.rules ?? [];
  const warnings = [];

  for (const fieldName of fields) {
    const value = String(record[fieldName] ?? "").trim();
    if (!value) {
      continue;
    }
    for (const rule of rules) {
      const pattern = new RegExp(rule.pattern, rule.flags ?? "");
      if (pattern.test(value)) {
        warnings.push({
          fieldName,
          message: `${fieldName} 是公開欄位，含有 ${rule.label_zh}，請確認是否應移除或改寫。`,
          ruleId: rule.id,
        });
      }
    }
  }

  return warnings;
}
