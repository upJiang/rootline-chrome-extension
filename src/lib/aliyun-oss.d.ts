declare module "ali-oss" {
  interface OssResponse {
    status?: number
    headers?: Record<string, string>
  }

  interface OssObjectResult {
    res?: OssResponse
    name?: string
    url?: string
  }

  interface OssOptions {
    region?: string
    bucket?: string
    accessKeyId?: string
    accessKeySecret?: string
    endpoint?: string
    secure?: boolean
    timeout?: number
  }

  interface OssPutOptions {
    mime?: string
    timeout?: number
    headers?: Record<string, string>
    progress?: (percent: number) => Promise<void> | void
  }

  class OSS {
    constructor(options: OssOptions)
    put(name: string, file: Blob, options?: OssPutOptions): Promise<OssObjectResult>
    head(name: string): Promise<OssObjectResult>
    delete(name: string): Promise<OssObjectResult>
  }

  export default OSS
}
