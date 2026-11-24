import { Buffer } from 'buffer'
import UPNG from 'upng-js'
import jpeg from 'jpeg-js'
import { createMobilePdfLogoTools } from '../../mobile-core/src/mobilePdfLogo.js'

const tools = createMobilePdfLogoTools({ Buffer, UPNG, jpeg })
export const prepareCoachPdfLogo = tools.preparePdfLogo
