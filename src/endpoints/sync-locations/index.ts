import newrelic from 'newrelic';

const rawHandler = async () => {};

export const handler = newrelic.setLambdaHandler(rawHandler);