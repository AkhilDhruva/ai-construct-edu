import { useParams } from 'react-router'
import { useMantle } from '../state/useMantle'

export function usePackage() {
  const { tentacle } = useParams()
  const content = useMantle((s) => s.content)
  return content.packages.find((p) => p.manifest.id === tentacle)
}
