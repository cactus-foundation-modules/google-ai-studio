/**
 * The prompt actually sent = the site's house style, then this job's own words.
 *
 * Two halves rather than one box, because they answer different questions. The
 * house style is "how this shop's photographs always look" and is written once;
 * the job's words are "what I want a picture of this time". Concatenating them
 * in that order means the specific instruction is the last thing the model
 * reads, which is where an instruction carries most weight.
 */
export function composePrompt(houseStyle: string, jobPrompt: string): string {
  const parts = [houseStyle.trim(), jobPrompt.trim()].filter((part) => part.length > 0)
  return parts.join('\n\n')
}
