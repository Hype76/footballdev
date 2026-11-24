import { Buffer } from 'buffer'
import UPNG from 'upng-js'
import jpeg from 'jpeg-js'
import { createMobilePdfLogoTools } from '../../mobile-core/src/mobilePdfLogo.js'

const tools = createMobilePdfLogoTools({ Buffer, UPNG, jpeg })
export const bytesToBase64 = tools.bytesToBase64
export const convertParentPdfLogo = tools.convertPdfLogo
export const prepareParentPdfLogo = tools.preparePdfLogo
