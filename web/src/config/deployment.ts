import manifest from './deployment.json'
import { parseDeployment, type Deployment } from '../protocol/deployment.ts'
let deployment: Deployment | null = null
let deploymentError = 'The hardened wallet is disabled until a reviewed version 2 Sepolia deployment is configured. The September addresses are historical references.'
try { deployment = parseDeployment(manifest.deployment); if (deployment) deploymentError = '' }
catch (e) { deploymentError = e instanceof Error ? e.message : 'Invalid deployment manifest.' }
export { deployment, deploymentError }
