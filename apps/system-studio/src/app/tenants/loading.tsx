import { LoadingState } from "@/components/states"

/**
 * GE-022-006. Streamed while the registry read is in flight.
 *
 * Next renders this automatically for the route segment, so the state is
 * reached by the real navigation rather than by a prop nobody sets. Without it
 * the page is blank until DynamoDB answers, and a blank page and a broken page
 * look the same to the person waiting.
 */
export default function Loading() {
  return <LoadingState label="the tenant registry" />
}
