export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="mt-2 text-xs leading-5 text-destructive">
      {message}
    </p>
  ) : null;
}
