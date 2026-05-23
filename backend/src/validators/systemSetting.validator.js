const { z } = require('zod');

const updateSystemSettingSchema = z.object({
  value: z.any(),
});

module.exports = { updateSystemSettingSchema };
