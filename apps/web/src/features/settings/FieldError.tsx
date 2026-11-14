export function FieldError({ message, id }: { message?: string; id: string }) {
  return message ? (
    <p id={id} role="alert" className="mt-2 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}
