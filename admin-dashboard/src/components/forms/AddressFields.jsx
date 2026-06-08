import { useFormContext, Controller } from 'react-hook-form';
import { Input } from '../ui/Input.jsx';
import { Select } from '../ui/Select.jsx';
import { INDIAN_STATES, getStateByName } from '../../utils/indianStates.js';

/**
 * Reusable address subform — drops into any react-hook-form parent
 * via `useFormContext`. Uses nested field names (`<prefix>.line1`,
 * `<prefix>.city`, etc.) so the produced form data matches the
 * backend's nested address shape directly — no transformation step.
 *
 * Props:
 *   prefix          — RHF path prefix (default 'billingAddress')
 *   stateCodeLocked — when true, the State select is disabled and the
 *                     stateCode field is read-only. Used by the customer
 *                     form when GSTIN already derived these values.
 *
 * Selecting a state via the dropdown auto-fills the stateCode field
 * via the form's `setValue` API. Manual stateCode override is allowed
 * unless `stateCodeLocked`.
 */
export default function AddressFields({ prefix = 'billingAddress', stateCodeLocked = false }) {
  const {
    register, control, setValue, formState: { errors },
  } = useFormContext();

  const fieldErrors = (prefix.split('.').reduce(
    (acc, k) => (acc ? acc[k] : undefined),
    errors,
  )) || {};

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Input
          label="Address Line 1"
          placeholder="Building, street"
          required
          error={fieldErrors.line1?.message}
          {...register(`${prefix}.line1`)}
        />
      </div>

      <div className="sm:col-span-2">
        <Input
          label="Address Line 2"
          placeholder="Landmark, area (optional)"
          error={fieldErrors.line2?.message}
          {...register(`${prefix}.line2`)}
        />
      </div>

      <Input
        label="City"
        required
        error={fieldErrors.city?.message}
        {...register(`${prefix}.city`)}
      />

      <Controller
        name={`${prefix}.state`}
        control={control}
        render={({ field }) => (
          <Select
            label="State"
            required
            disabled={stateCodeLocked}
            error={fieldErrors.state?.message}
            placeholder="Select state"
            options={INDIAN_STATES.map(s => ({ value: s.name, label: s.name }))}
            value={field.value || ''}
            onChange={(e) => {
              const name = e.target.value;
              field.onChange(name);
              const match = getStateByName(name);
              if (match) setValue(`${prefix}.stateCode`, match.code, { shouldValidate: true });
            }}
          />
        )}
      />

      <Input
        label="State Code"
        placeholder="e.g. 27"
        readOnly={stateCodeLocked}
        helperText={stateCodeLocked ? 'Derived from GSTIN' : '2-digit GSTIN state code'}
        required
        error={fieldErrors.stateCode?.message}
        {...register(`${prefix}.stateCode`)}
      />

      <Input
        label="Pincode"
        placeholder="6-digit"
        required
        inputMode="numeric"
        maxLength={6}
        error={fieldErrors.pincode?.message}
        {...register(`${prefix}.pincode`)}
      />
    </div>
  );
}
