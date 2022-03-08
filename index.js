addEventListener('fetch', event => {
  event.respondWith(handleRequest(event))
})

async function handleRequest(event) {
  const request = event.request
  // Block all methods except GET and HEAD
  if (request.method === 'GET' || request.method === 'HEAD') {
      let response = await serveAsset(event, false)
      // Set error code if error
      if (response.status > 399) {
          let response_text = await response.text()
          response = new Response(
              'Error fetching resource from SD: ' + response_text,
              { status: response.status },
          )
      }
      return response
  } else {
      return new Response(null, { status: 405 })
  }
}

async function authenticate(event) {
  let url = 'https://json.schedulesdirect.org/20141201/token'

  const body = {
    username: SD_USERNAME,
    password: SD_PASSWORD
  }

  const headers = new Headers(event.request.headers)
  headers.set('Content-Type', 'application/json')

  const init = {
    body: JSON.stringify(body),
    method: 'POST',
    headers: headers
  }

  const response = await fetch(url, init)
  if (response.status == 200) {
    return new Response(null, { status: 200 })
  } else {
    return new Response('Invalid credentials', { status: 401 })
  }
}

async function serveAsset(event, auth) {
  const request = event.request
  const reqHead = request.headers
  const url = new URL(request.url)
  const fields = url.searchParams
  let image = fields.get('image')

  // Preconditions
  // fetch param actually specified
  if (image === null) {
      return new Response(null, { status: 400 })
  }

  // Make a new headers from the request headers
  const fetchHeaders = new Headers(event.request.headers)

  // Set 304 not modified response headers
  if (reqHead.get('If-None-Match') !== null) {
      fetchHeaders.set('If-None-Match', reqHead.get('If-None-Match'))
  }
  if (reqHead.get('If-Modified-Since') !== null) {
      fetchHeaders.set('If-Modified-Since', reqHead.get('If-Modified-Since'))
  }
  if (reqHead.get('Range') !== null) {
      fetchHeaders.set('Range', reqHead.get('Range'))
  }

  // Force authentication with this request
  if (auth) {
    let authenticated = await authenticate(event)
    if (authenticated.status == 200) {
      console.log('> Authenticated with SD')
    } else {
      return authenticated
    }
  }

  const response = await fetch(
      `https://json.schedulesdirect.org/20141201/image/${image}`,
      { headers: fetchHeaders },
  )

  const respHead = response.headers
  const type = respHead.get('Content-Type', respHead.get('content-type')) || 'application/octet-stream'

  // We are a json response ... something probably went wrong
  if (type.indexOf('application/json') !== -1) {
    let temp_response = new Response(response.body, response)
    let temp_json = await temp_response.json()
    let temp_text = temp_json['response']
    console.log(`> SD returned ${temp_text}`)

    // We need to authenticate
    if (!auth && temp_text == 'UNKNOWN_USER') {
      return await serveAsset(event, true)
    }

    // Well it failed ... return something
    return new Response(temp_text, { status: 400 })
  }

  // Set headers
  const headers = new Headers({
      'Cache-Control': `public, max-age=604800`,
      'Content-Type': type,
      ETag: respHead.get('ETag'),
      'Last-Modified': respHead.get('Last-Modified'),
      'CF-Cache-Status': respHead.get('CF-Cache-Status')
          ? respHead.get('CF-Cache-Status')
          : 'UNKNOWN',
      Date: respHead.get('Date'),
      'Accept-Ranges': 'bytes',
  })
  if (respHead.get('Age') !== null) {
      headers.set('Age', respHead.get('Age'))
  }
  if (response.status == 206) {
      headers.set('Content-Range', respHead.get('Content-Range'))
  }

  return new Response(response.body, { ...response, headers })
}