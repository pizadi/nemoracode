import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { useI18n } from "~/context/i18n"
import { LocaleLinks } from "~/component/locale-links"
import { SocialMeta } from "~/component/social-meta"
import previewLogoLight from "../../asset/brand/preview-nemoracode-logo-light.png"
import previewLogoDark from "../../asset/brand/preview-nemoracode-logo-dark.png"
import previewLogoLightSquare from "../../asset/brand/preview-nemoracode-logo-light-square.png"
import previewLogoDarkSquare from "../../asset/brand/preview-nemoracode-logo-dark-square.png"
import previewWordmarkLight from "../../asset/brand/preview-nemoracode-wordmark-light.png"
import previewWordmarkDark from "../../asset/brand/preview-nemoracode-wordmark-dark.png"
import previewWordmarkSimpleLight from "../../asset/brand/preview-nemoracode-wordmark-simple-light.png"
import previewWordmarkSimpleDark from "../../asset/brand/preview-nemoracode-wordmark-simple-dark.png"
import logoLightPng from "../../asset/brand/nemoracode-logo-light.png"
import logoDarkPng from "../../asset/brand/nemoracode-logo-dark.png"
import logoLightSquarePng from "../../asset/brand/nemoracode-logo-light-square.png"
import logoDarkSquarePng from "../../asset/brand/nemoracode-logo-dark-square.png"
import wordmarkLightPng from "../../asset/brand/nemoracode-wordmark-light.png"
import wordmarkDarkPng from "../../asset/brand/nemoracode-wordmark-dark.png"
import wordmarkSimpleLightPng from "../../asset/brand/nemoracode-wordmark-simple-light.png"
import wordmarkSimpleDarkPng from "../../asset/brand/nemoracode-wordmark-simple-dark.png"
import logoLightSvg from "../../asset/brand/nemoracode-logo-light.svg"
import logoDarkSvg from "../../asset/brand/nemoracode-logo-dark.svg"
import logoLightSquareSvg from "../../asset/brand/nemoracode-logo-light-square.svg"
import logoDarkSquareSvg from "../../asset/brand/nemoracode-logo-dark-square.svg"
import wordmarkLightSvg from "../../asset/brand/nemoracode-wordmark-light.svg"
import wordmarkDarkSvg from "../../asset/brand/nemoracode-wordmark-dark.svg"
import wordmarkSimpleLightSvg from "../../asset/brand/nemoracode-wordmark-simple-light.svg"
import wordmarkSimpleDarkSvg from "../../asset/brand/nemoracode-wordmark-simple-dark.svg"
const brandAssets = "/nemoracode-brand-assets.zip"

export default function Brand() {
  const i18n = useI18n()
  const alt = i18n.t("brand.meta.description")
  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)

      const link = document.createElement("a")
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
      console.error("Download failed:", error)
      const link = document.createElement("a")
      link.href = url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  return (
    <main data-page="enterprise">
      <Title>{i18n.t("brand.title")}</Title>
      <LocaleLinks path="/brand" />
      <Meta name="description" content={i18n.t("brand.meta.description")} />
      <SocialMeta title={i18n.t("brand.title")} description={i18n.t("brand.meta.description")} path="/brand" />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <h1>{i18n.t("brand.heading")}</h1>
            <p>{i18n.t("brand.subtitle")}</p>
            <button
              data-component="download-button"
              onClick={() => downloadFile(brandAssets, "nemoracode-brand-assets.zip")}
            >
              {i18n.t("brand.downloadAll")}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="square"
                />
              </svg>
            </button>

            <div data-component="brand-grid">
              <div>
                <img src={previewLogoLight} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoLightPng, "nemoracode-logo-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoLightSvg, "nemoracode-logo-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoDark} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoDarkPng, "nemoracode-logo-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoDarkSvg, "nemoracode-logo-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoLightSquare} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoLightSquarePng, "nemoracode-logo-light-square.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoLightSquareSvg, "nemoracode-logo-light-square.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoDarkSquare} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoDarkSquarePng, "nemoracode-logo-dark-square.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoDarkSquareSvg, "nemoracode-logo-dark-square.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkLight} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkLightPng, "nemoracode-wordmark-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkLightSvg, "nemoracode-wordmark-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkDark} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkDarkPng, "nemoracode-wordmark-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkDarkSvg, "nemoracode-wordmark-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkSimpleLight} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleLightPng, "nemoracode-wordmark-simple-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkSimpleLightSvg, "nemoracode-wordmark-simple-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkSimpleDark} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleDarkPng, "nemoracode-wordmark-simple-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkSimpleDarkSvg, "nemoracode-wordmark-simple-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
        <Footer />
      </div>
      <Legal />
    </main>
  )
}
