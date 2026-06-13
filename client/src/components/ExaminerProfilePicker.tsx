import type { ExaminerProfile } from "../../../shared/contracts.js";

interface ExaminerProfilePickerProps {
  profiles: ExaminerProfile[];
  value: string;
  disabled?: boolean;
  onChange: (profileId: string) => void;
}

export function ExaminerProfilePicker({
  profiles,
  value,
  disabled = false,
  onChange,
}: ExaminerProfilePickerProps) {
  const selected = profiles.find((profile) => profile.id === value);
  return (
    <div className="examiner-profile-picker">
      <label htmlFor="examiner-profile">Профиль экзаменатора</label>
      <select
        id="examiner-profile"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {profiles.map((profile) => (
          <option value={profile.id} key={profile.id}>{profile.name}</option>
        ))}
      </select>
      {selected && <p>{selected.description}</p>}
    </div>
  );
}
