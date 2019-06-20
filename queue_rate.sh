#!/bin/bash
function get_rabbit_queue {
	rabbitmqctl list_queues | tail -n 1 | cut -f 2
}

first=$(get_rabbit_queue)
sleep 60s
second=$(get_rabbit_queue)
echo "Queue is $second items"

rate="$((first - second))"
echo "Processing at $rate items per minute"

formula="scale=3; $second / $rate / 60 / 24"
estimate=$( echo "$formula" | bc )
echo "Estimate of $estimate days remaining"
