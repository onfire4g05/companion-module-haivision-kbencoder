module.exports = {
    addStateRunning(context, config, actions, feedbacks) {
        const new_feedbacks = feedbacks.map(x => {
            if (x.type === 'state') x.options.state = 'running'

            return x
        })

        return true;
    }
}
