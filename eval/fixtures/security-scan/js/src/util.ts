export function parse(text: string) {
  const data: any = JSON.parse(text);
  return data.value;
}
