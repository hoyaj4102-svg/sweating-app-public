import React from "react";
import { Link } from "wouter";
import { type ConsentChoice } from "./consent";

type ConsentFieldsProps = {
  value: ConsentChoice;
  onChange: (next: ConsentChoice) => void;
};

export function ConsentFields({ value, onChange }: ConsentFieldsProps) {
  return (
    <fieldset className="consent-fields" data-testid="consent-fields">
      <legend>필수 동의</legend>
      <label>
        <input
          type="checkbox"
          checked={value.terms}
          onChange={(event) => onChange({ ...value, terms: event.target.checked })}
          data-testid="consent-terms"
        />
        <span><Link href="/terms">이용약관</Link>에 동의합니다. (필수)</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.privacy}
          onChange={(event) => onChange({ ...value, privacy: event.target.checked })}
          data-testid="consent-privacy"
        />
        <span><Link href="/privacy">개인정보 수집·이용</Link>에 동의합니다. (필수)</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.overseas_transfer}
          onChange={(event) => onChange({ ...value, overseas_transfer: event.target.checked })}
          data-testid="consent-overseas"
        />
        <span><Link href="/privacy#overseas">개인정보 국외 이전</Link>에 별도로 동의합니다. (필수)</span>
      </label>
    </fieldset>
  );
}
