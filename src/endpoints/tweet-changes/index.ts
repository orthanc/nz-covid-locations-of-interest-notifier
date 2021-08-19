import newrelic from 'newrelic';
import { SNSEvent } from 'aws-lambda';

const rawHandler = async (event: SNSEvent) => {
  const message = JSON.parse(event.Records[0].Sns.Message);
  console.log(JSON.stringify(message, undefined, 2));
};

export const handler = newrelic.setLambdaHandler(rawHandler);