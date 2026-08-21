/**
 * HTTP status codes used across the API layer.
 */
class HttpStatus {
  static OK = 200;

  static NO_CONTENT = 204;

  static PARTIAL_CONTENT = 206;

  static BAD_REQUEST = 400;

  static NOT_FOUND = 404;

  static CONFLICT = 409;

  static CONTENT_TOO_LARGE = 413;

  static UNPROCESSABLE_ENTITY = 422;

  static INTERNAL_SERVER_ERROR = 500;

  static BAD_GATEWAY = 502;

  static SERVICE_UNAVAILABLE = 503;
}

export { HttpStatus };
